import type { EstadoRequisito } from './completitud';

/**
 * Las cuatro palabras de estado que ve el usuario. Son las del motor con otro
 * nombre, no estados nuevos: el cálculo sigue siendo el de `completitud.js`.
 */
export const ETIQUETA_ESTADO: Record<EstadoRequisito, string> = {
    Cumplido: 'Completado',
    Parcial: 'Incompleto',
    Pendiente: 'Pendiente',
    Vencido: 'Vencido',
    NoAplica: 'No aplica',
    FueraDeAlcance: 'No aplica',
};
