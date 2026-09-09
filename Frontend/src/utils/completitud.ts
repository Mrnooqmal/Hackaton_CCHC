/**
 * Presentación de la completitud del FUF.
 *
 * A diferencia de `estructuraPreventiva.ts`, esto NO es un espejo del motor: la
 * evaluación corre en el servidor porque necesita los documentos del repositorio,
 * y duplicarla en el cliente daría dos verdades sobre el mismo requisito. Acá solo
 * viven los estados y cómo se pintan.
 *
 * El cálculo que sí debe funcionar sin conexión es el de OBLIGACIONES (qué órgano
 * corresponde según la dotación), y ése ya está en `estructuraPreventiva.ts`.
 */

export const ESTADO_REQUISITO = {
    CUMPLIDO: 'Cumplido',
    PARCIAL: 'Parcial',
    PENDIENTE: 'Pendiente',
    VENCIDO: 'Vencido',
    NO_APLICA: 'NoAplica',
    FUERA_DE_ALCANCE: 'FueraDeAlcance',
} as const;
export type EstadoRequisito = typeof ESTADO_REQUISITO[keyof typeof ESTADO_REQUISITO];

/** Los dos que no penalizan: salen del denominador del porcentaje. */
export const ESTADOS_NO_PENALIZAN: EstadoRequisito[] = [
    ESTADO_REQUISITO.NO_APLICA, ESTADO_REQUISITO.FUERA_DE_ALCANCE,
];

export const ESTADO_LABEL: Record<EstadoRequisito, string> = {
    Cumplido: 'Cumplido',
    Parcial: 'Parcial',
    Pendiente: 'Pendiente',
    Vencido: 'Vencido',
    NoAplica: 'No aplica',
    FueraDeAlcance: 'Fuera de alcance',
};

/** Variante de Badge por estado. `NoAplica` va en neutro a propósito: no es una
 *  falta, y pintarlo de rojo empujaría a "arreglar" algo que no corresponde. */
export const ESTADO_VARIANTE: Record<EstadoRequisito, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'secondary'> = {
    Cumplido: 'success',
    Parcial: 'warning',
    Pendiente: 'info',
    Vencido: 'danger',
    NoAplica: 'neutral',
    FueraDeAlcance: 'secondary',
};

export interface RequisitoFuf {
    id: string;
    item: number | null;
    bloque: string | null;
    titulo: string;
    ambito: string;
    estado: EstadoRequisito;
    detalle: string | null;
    /** Solo en `NoAplica`: por qué no es exigible. El índice del expediente la pide. */
    justificacion: string | null;
}

export interface ResumenCompletitud {
    total: number;
    exigibles: number;
    excluidos: number;
    cumplidos: number;
    porEstado: Record<EstadoRequisito, number>;
    progreso: number;
}

export interface BloqueCompletitud {
    bloque: string;
    requisitos: RequisitoFuf[];
    resumen: ResumenCompletitud;
}

export interface CompletitudAmbito {
    ambito: string;
    obraId: string | null;
    dotacion: { dotacion: number; origen: string; calculada: number; declarada: number | null };
    limiteRegistroDT: string | null;
    requisitos: RequisitoFuf[];
    resumen: ResumenCompletitud;
    bloques: BloqueCompletitud[];
}

/** Color del porcentaje, con los mismos cortes que ya usa el resto del panel DS44. */
export const colorProgreso = (p: number): string =>
    p >= 80 ? '#10b981' : p >= 50 ? '#f59e0b' : '#ef4444';
