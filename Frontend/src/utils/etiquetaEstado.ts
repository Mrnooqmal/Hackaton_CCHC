import { ESTADO_LABEL, type EstadoRequisito, type RequisitoFuf } from './completitud';

/**
 * Las palabras de estado que ve el usuario. Es la misma tabla de
 * `completitud.ts` (y del reporte exportado): se reexporta con este nombre para
 * no tocar a quienes ya la importan desde acá.
 */
export const ETIQUETA_ESTADO = ESTADO_LABEL;

/** ESPEJO de ETIQUETA_PENDIENTE_FIRMA en Backend/lib/completitud-export.js. */
export const ETIQUETA_PENDIENTE_FIRMA = 'Pendiente de firma';

/** Etiqueta de un requisito: un Parcial que solo espera firmas se llama así. */
export const etiquetaRequisito = (r: Pick<RequisitoFuf, 'estado' | 'pendienteFirma'>): string =>
    (r.pendienteFirma ? ETIQUETA_PENDIENTE_FIRMA : ESTADO_LABEL[r.estado]);

/**
 * Filtros por estado de las listas de requisitos (obra y repositorio).
 * "Pendiente de firma" es un filtro aparte y no entra en "Incompleto": quien
 * busca lo incompleto busca lo que tiene que cargar o resolver, no firmas.
 */
export type FiltroEstado = 'todos' | 'Vencido' | 'Pendiente' | 'Parcial' | 'PendienteFirma' | 'Cumplido';
export const FILTROS_ESTADO: Array<{ key: FiltroEstado; label: string }> = [
    { key: 'todos', label: 'Todos' },
    { key: 'Vencido', label: 'Vencido' },
    { key: 'Pendiente', label: 'Pendiente' },
    { key: 'Parcial', label: 'Incompleto' },
    { key: 'PendienteFirma', label: ETIQUETA_PENDIENTE_FIRMA },
    { key: 'Cumplido', label: 'Completado' },
];
export const coincideFiltro = (r: { estado: EstadoRequisito; pendienteFirma?: boolean }, f: FiltroEstado): boolean => {
    if (f === 'todos') return true;
    if (f === 'PendienteFirma') return Boolean(r.pendienteFirma);
    if (f === 'Parcial') return r.estado === 'Parcial' && !r.pendienteFirma;
    return r.estado === f;
};
