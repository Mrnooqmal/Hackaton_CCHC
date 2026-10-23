/**
 * Prescripciones de medidas — DS 44 Art. 70 (ítem 58 del FUF).
 *
 * Fechas y validaciones que comparten el listado y los dos formularios. Las
 * reglas son ESPEJO de Backend/lib/prescripciones.js (`validarPrescripcion`):
 * se validan acá para que el error aparezca bajo el campo que lo causa, antes
 * de ir al servidor, pero el servidor las vuelve a aplicar.
 */
import type { Prescripcion } from '../api/estructura.api';

/** Fecha de calendario LOCAL (YYYY-MM-DD). `toISOString()` daría la de UTC:
 *  desde las 21:00 en Chile ya es "mañana" y el campo nacía con fecha futura. */
export const fechaLocal = (d: Date = new Date()): string => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const hoy = () => fechaLocal();

/** Fecha de calendario local de un instante guardado. */
export const fechaDe = (iso?: string | null) => (iso ? fechaLocal(new Date(iso)) : '');

/**
 * Instante a guardar para la fecha de un HECHO (prescripción, implementación):
 * el inicio del día local. Antes se mandaba el mediodía local, y el servidor
 * —que rechaza fechas futuras comparando contra el instante actual— rechazaba
 * "hoy" durante toda la mañana.
 */
export const inicioDelDia = (fecha: string) => new Date(`${fecha}T00:00:00`).toISOString();

/** Instante a guardar para un PLAZO: el final del día. La medida vence cuando
 *  el día del plazo termina, no cuando empieza. */
export const finDelDia = (fecha: string) => new Date(`${fecha}T23:59:59`).toISOString();

export const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CL') : '—');

/** "dd/mm" o "dd/mm/aaaa" de una fecha de calendario YYYY-MM-DD. */
export const fmtFecha = (fecha: string, conAnio = true) => {
    const [a, m, d] = fecha.split('-');
    return conAnio ? `${d}/${m}/${a}` : `${d}/${m}`;
};

/** Días de calendario de `desde` a `hasta` (ambas YYYY-MM-DD). */
export const diasEntre = (desde: string, hasta: string) =>
    Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);

export const sumarDias = (fecha: string, dias: number) => {
    const d = new Date(`${fecha}T12:00:00`);
    d.setDate(d.getDate() + dias);
    return fechaLocal(d);
};

const plural = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;

/** El plazo traducido a días: "vence en 7 días", "venció hace 3 días". */
export function describirPlazo(plazo: string, referencia = hoy()): string {
    const dias = diasEntre(referencia, plazo);
    if (dias === 0) return 'vence hoy';
    if (dias === 1) return 'vence mañana';
    if (dias > 0) return `vence en ${plural(dias, 'día', 'días')}`;
    return `venció hace ${plural(-dias, 'día', 'días')}`;
}

/** Cuándo se implementó respecto del plazo, para el pie y el listado. */
export function describirCumplimiento(implementacion: string, plazo: string | null): string | null {
    if (!plazo) return null;
    const dias = diasEntre(plazo, implementacion);
    if (dias === 0) return 'el día del plazo';
    if (dias < 0) return `${plural(-dias, 'día', 'días')} antes del plazo`;
    return `${plural(dias, 'día', 'días')} después del plazo`;
}

/**
 * Orden de urgencia: vencidas primero (la más atrasada arriba), después las
 * pendientes por plazo más próximo (sin plazo al final), y al último las
 * implementadas, la más reciente primero.
 */
export function ordenarPorUrgencia(lista: Prescripcion[]): Prescripcion[] {
    const rango = { Vencida: 0, Pendiente: 1, Implementada: 2 } as const;
    return [...lista].sort((a, b) => {
        if (a.estado !== b.estado) return rango[a.estado] - rango[b.estado];
        if (a.estado === 'Implementada') {
            return String(b.fechaImplementacion).localeCompare(String(a.fechaImplementacion));
        }
        return String(a.plazoImplementacion || '9999').localeCompare(String(b.plazoImplementacion || '9999'));
    });
}

// ─── Validación ──────────────────────────────────────────────────────────────

export type CampoNueva = 'descripcion' | 'fechaPrescripcion' | 'plazo' | 'documento';
export type CampoImplementacion = 'fechaImplementacion' | 'evidencia';

export interface ErrorCampo<C extends string> {
    campo: C;
    /** Qué pasa, en el resumen ("es posterior a hoy"). */
    resumen: string;
    /** Qué pasa y cómo arreglarlo, bajo el campo. */
    mensaje: string;
}

export function validarNueva(
    form: { descripcion: string; fechaPrescripcion: string; conPlazo: boolean; plazo: string },
    referencia = hoy(),
): ErrorCampo<CampoNueva>[] {
    const errores: ErrorCampo<CampoNueva>[] = [];
    if (!form.descripcion.trim()) {
        errores.push({
            campo: 'descripcion', resumen: 'falta describirla',
            mensaje: 'Describe qué se ordenó implementar. Sin esto no se puede hacer seguimiento.',
        });
    }
    if (!form.fechaPrescripcion) {
        errores.push({
            campo: 'fechaPrescripcion', resumen: 'falta la fecha',
            mensaje: 'Indica la fecha que figura en el documento.',
        });
    } else if (form.fechaPrescripcion > referencia) {
        errores.push({
            campo: 'fechaPrescripcion', resumen: 'es posterior a hoy',
            mensaje: `El ${fmtFecha(form.fechaPrescripcion, false)} todavía no llega. Usa la fecha que figura en el documento.`,
        });
    }
    if (form.conPlazo) {
        if (!form.plazo) {
            errores.push({
                campo: 'plazo', resumen: 'falta la fecha',
                mensaje: 'Indica hasta cuándo hay para implementarla, o marca "Sin plazo".',
            });
        } else if (form.fechaPrescripcion && form.plazo < form.fechaPrescripcion) {
            errores.push({
                campo: 'plazo', resumen: 'es anterior a la prescripción',
                mensaje: `El plazo no puede ser anterior a la prescripción (${fmtFecha(form.fechaPrescripcion)}).`,
            });
        }
    }
    return errores;
}

export function validarImplementacion(
    form: { fechaImplementacion: string; tieneEvidencia: boolean },
    fechaPrescripcion: string,
    referencia = hoy(),
): ErrorCampo<CampoImplementacion>[] {
    const errores: ErrorCampo<CampoImplementacion>[] = [];
    const f = form.fechaImplementacion;
    if (!f) {
        errores.push({
            campo: 'fechaImplementacion', resumen: 'falta la fecha',
            mensaje: 'Indica cuándo quedó implementada la medida.',
        });
    } else if (f > referencia) {
        errores.push({
            campo: 'fechaImplementacion', resumen: 'es posterior a hoy',
            mensaje: `El ${fmtFecha(f, false)} todavía no llega. Registra la fecha en que realmente se implementó.`,
        });
    } else if (f < fechaPrescripcion) {
        errores.push({
            campo: 'fechaImplementacion', resumen: 'es anterior a la prescripción',
            mensaje: `El ${fmtFecha(f, false)} es anterior a la prescripción (${fmtFecha(fechaPrescripcion, false)}). Una medida no se implementa antes de que la ordenen.`,
        });
    }
    if (!form.tieneEvidencia) {
        errores.push({
            campo: 'evidencia', resumen: 'falta adjuntarla',
            mensaje: 'Adjunta la evidencia: sin ella no se puede dar por implementada.',
        });
    }
    return errores;
}

/**
 * Lleva un error del servidor al campo que lo causa. Los mensajes salen de
 * `validarPrescripcion`; lo que no se reconoce queda como error general.
 */
export function campoDeErrorServidor(mensaje: string): CampoNueva | CampoImplementacion | null {
    const m = mensaje.toLowerCase();
    if (m.includes('fecha de la prescripción')) return 'fechaPrescripcion';
    if (m.includes('fecha de implementación') || m.includes('anterior a la prescripción')) return 'fechaImplementacion';
    if (m.includes('descripción')) return 'descripcion';
    if (m.includes('evidencia')) return 'evidencia';
    return null;
}
