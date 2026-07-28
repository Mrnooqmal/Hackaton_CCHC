import type { Activity } from '../api/client';

// Semáforo de seguimiento de actividades (§6 del checklist):
//   verde   = realizada (completada)
//   amarillo= pendiente dentro de plazo (hoy o futuro, sin cerrar)
//   rojo    = vencida (pasó su día sin cerrarse) o borrador vencido
//   neutral = cancelada (fuera del seguimiento)
export type NivelSeguimiento = 'verde' | 'amarillo' | 'rojo' | 'neutral';

export interface SeguimientoActividad {
    nivel: NivelSeguimiento;
    /** true cuando la actividad quedó sin realizar dentro del plazo. */
    vencida: boolean;
    label: string;
    /** Token de color CChC para badges/indicadores. */
    color: string;
}

/** Fecha local YYYY-MM-DD (sin pasar por UTC para no correr el día). */
export const hoyISO = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Clasifica una actividad para el semáforo de seguimiento. `hoy` se inyecta para
 * poder testear; por defecto usa el día local. Es defensivo: actividades sin
 * `fecha` o con estados desconocidos caen a neutral/amarillo sin romper.
 */
export function estadoSeguimiento(a: Activity, hoy: string = hoyISO()): SeguimientoActividad {
    if (a.estado === 'completada') {
        return { nivel: 'verde', vencida: false, label: 'Realizada', color: 'var(--success-500)' };
    }
    if (a.estado === 'cancelada') {
        return { nivel: 'neutral', vencida: false, label: 'Cancelada', color: 'var(--text-muted)' };
    }
    // borrador / programada (o cualquier no-terminal): depende de la fecha.
    const fecha = a.fecha || '';
    const vencida = fecha !== '' && fecha < hoy;
    if (vencida) {
        return {
            nivel: 'rojo',
            vencida: true,
            label: a.estado === 'borrador' ? 'Sin realizar (vencida)' : 'Vencida',
            color: 'var(--danger-500)',
        };
    }
    return {
        nivel: 'amarillo',
        vencida: false,
        label: a.estado === 'borrador' ? 'Borrador' : 'Pendiente',
        color: 'var(--warning-500)',
    };
}
